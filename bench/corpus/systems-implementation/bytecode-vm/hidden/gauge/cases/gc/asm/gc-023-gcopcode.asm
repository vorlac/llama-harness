; case gc-023-gcopcode
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  POP
  GC
  GCLIVE
  PRINT
  RET
.end
