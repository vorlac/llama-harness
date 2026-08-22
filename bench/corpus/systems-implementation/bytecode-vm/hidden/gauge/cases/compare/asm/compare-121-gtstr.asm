; case compare-121-gtstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  GT
  PRINT
  RET
.end
