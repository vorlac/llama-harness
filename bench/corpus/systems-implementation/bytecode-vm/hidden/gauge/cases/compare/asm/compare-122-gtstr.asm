; case compare-122-gtstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR ""
  GT
  PRINT
  RET
.end
