; case compare-050-gtint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 0
  GT
  PRINT
  RET
.end
