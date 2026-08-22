; case compare-129-gtstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "abc"
  PUSH_STR "ab"
  GT
  PRINT
  RET
.end
