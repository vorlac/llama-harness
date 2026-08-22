; case compare-060-gtint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT -42
  PUSH_INT -43
  GT
  PRINT
  RET
.end
