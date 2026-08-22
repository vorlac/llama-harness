; case compare-039-leint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 0
  PUSH_INT 1
  LE
  PRINT
  RET
.end
